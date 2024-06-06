import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as path from "path";
import * as mime from "mime";

// Create an S3 bucket to host the static website
const siteBucket = new aws.s3.Bucket("siteBucket");

// Configure the bucket as a website
const siteBucketWebsiteConfig = new aws.s3.BucketWebsiteConfigurationV2("siteBucketWebsiteConfig", {
    bucket: siteBucket.bucket,
    indexDocument: { suffix: "index.html" },
    errorDocument: { key: "error.html" },
});

// Create CloudFront Origin Access Identity
const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity("originAccessIdentity", {
    comment: "OAI for accessing S3 bucket",
});

// Update the bucket policy to allow CloudFront to read objects
const bucketPolicy = new aws.s3.BucketPolicy("bucketPolicy", {
    bucket: siteBucket.bucket,
    policy: pulumi.all([siteBucket.bucket, originAccessIdentity.iamArn]).apply(([bucketName, oaiArn]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: {
                AWS: oaiArn,
            },
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`,
        }],
    })),
});

// Upload the website content to the S3 bucket
const siteDir = "./content";
for (const item of fs.readdirSync(siteDir)) {
    const filePath = path.join(siteDir, item);
    new aws.s3.BucketObject(item, {
        bucket: siteBucket,
        source: new pulumi.asset.FileAsset(filePath),
        contentType: mime.getType(filePath) || undefined,
    });
}

// Create a CloudFront distribution to serve the website
const cdn = new aws.cloudfront.Distribution("cdn", {
    origins: [{
        originId: siteBucket.arn,
        domainName: siteBucket.bucketRegionalDomainName,
        s3OriginConfig: {
            originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
        },
    }],
    enabled: true,
    defaultRootObject: "index.html",
    defaultCacheBehavior: {
        targetOriginId: siteBucket.arn,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        forwardedValues: {
            queryString: false,
            cookies: { forward: "none" },
        },
        minTtl: 0,
        defaultTtl: 3600,
        maxTtl: 86400,
    },
    priceClass: "PriceClass_100",
    restrictions: {
        geoRestriction: { restrictionType: "none" },
    },
    viewerCertificate: { cloudfrontDefaultCertificate: true },
});

// Create a Route 53 hosted zone for the domain
const hostedZone = new aws.route53.Zone("abc-com-zone", {
    name: "abc.com",
});

// Create an alias record for the CDN distribution
const record = new aws.route53.Record("cdnAliasRecord", {
    zoneId: hostedZone.id,
    name: "www.abc.com",
    type: "A",
    aliases: [{
        name: cdn.domainName,
        zoneId: cdn.hostedZoneId,
        evaluateTargetHealth: false,
    }],
});

// Export the URLs
export const bucketName = siteBucket.bucket;
export const cdnUrl = cdn.domainName;
export const nameServers = hostedZone.nameServers;

